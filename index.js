let webpack = require("webpack");
let async = require('async');
let gulp = require('gulp');
let fs = require('fs');
let path = require('path');
let utils = require('./lib/utils');
global.srcPrefix = '/src/';
global.deployPrefix = '/deploy/';
//global.debugDomain = /^\$!{0,1}\{.+?\}/i;
global.debugDomain = /\/sf/;
global.sfPrefix = '/sf/';

exports = module.exports = function (options) {
    let isExpressProject = utils.hasArgument(process.argv, '--express');
    let isHttps = utils.hasArgument(process.argv, '--https');
    let staticFilesDirectory = options.staticFilesDirectory;

    if (staticFilesDirectory && typeof staticFilesDirectory == 'string') {
        if (!fs.existsSync(staticFilesDirectory)) {
            throw new Error('can\'t find the static files directory ', staticFilesDirectory);
        }
    } else {
        throw new Error('can\'t find the arugment -s, this argument is webapp static file directory!');
    }

    global.staticDirectory = utils.normalizePath(staticFilesDirectory);

    if (!fs.existsSync(path.join(global.staticDirectory, 'src'))) {
        throw new Error("can't find 'src' directory in staticDirectory ");
    }

    let webappDirectory = options.webappDirectory;
    let webappDirectoryList = [];
    if (webappDirectory && typeof webappDirectory == 'string') {
        webappDirectoryList = webappDirectory.split(',');
        webappDirectoryList.forEach(function (item, index) {
            item = item.trim();
            if (!fs.existsSync(item)) {
                throw new Error('can\'t find the webapp directory: ' + item);
            }
        });
    } else {
        throw new Error('can\'t find the arugment -w, this argument is webapp directory!');
    }

    let templateFileList = [];

    webappDirectoryList.forEach(function (item, index) {
        let templateViewSrcPagePath = path.join(item, '/src/main/webapp/WEB-INF/view/src/');

        if (isExpressProject) {
            templateViewSrcPagePath = path.join(item, '/views/src/');
        }
        //if no webapp directory, then exit;
        if (!fs.existsSync(templateViewSrcPagePath)) {
            throw new Error('can\'t find the webapp velocity template directory: ' + templateViewSrcPagePath);
        }
        utils.getAllFilesByDir(templateViewSrcPagePath, templateFileList, isExpressProject ? ['.js', '.jsx', '.html', '.tpl'] : ['.vm', '.html', '.tpl']);
    });

    let defaultLiveReloadPort = 8999;
    let defaultHttpsLiveReloadPort = 8998;
    let defaultHotPort = 9797;
    global.livereloadPort = typeof options.livereloadPort != 'undefined' && utils.isInt(options.livereloadPort) ? parseInt(options.livereloadPort) : defaultLiveReloadPort;
    global.httpsLivereloadPort = typeof options.httpsLivereloadPort != 'undefined' && utils.isInt(options.httpsLivereloadPort) ? parseInt(options.httpsLivereloadPort) : defaultHttpsLiveReloadPort;
    global.hotPort = typeof options.hotPort != 'undefined' && utils.isInt(options.hotPort) ? parseInt(options.hotPort) : defaultHotPort;

    let cssCacheList = {};
    let cssCompileList = [];
    let regexpStaticFilesPrefix = utils.getRegexpStaticFilesPrefix();

    templateFileList.forEach(function (tplPath) {
        let tplContent = fs.readFileSync(tplPath).toString();

        tplContent.replace(utils.getRegexpCSSLinkElements(), function ($link) {
            $link.replace(utils.getRegexpCSSHrefValue(), function ($cssLink, $someSplitStr, $href) {
                let cssPath = $href.replace(regexpStaticFilesPrefix, '');
                if (!cssCacheList[cssPath]) {
                    if ($href && !($href.indexOf('http') == 0)) {
                        if (isExpressProject) {
                            cssCompileList.push(utils.normalizePath(path.join(global.staticDirectory, cssPath.replace(global.sfPrefix, '/'))));
                        } else {
                            cssCompileList.push(path.join(global.staticDirectory, cssPath));
                        }

                        cssCacheList[cssPath] = true;
                    }
                }

                return $cssLink;
            });

            return $link;
        });
    });

    let jsCacheList = {};
    let jsCompileList = [];
    let jsCompileListWithPureReact = [];

    templateFileList.forEach(function (tplPath, index) {
        let tplContent = fs.readFileSync(tplPath).toString();
        tplContent.replace(utils.getRegexpScriptElements(), function ($1, $2) {
            if ($2.indexOf('type="text/html"') > -1 || $2.indexOf('x-template') > -1) {
                return $1;
            }

            if ($2.toLowerCase().indexOf('release="false"') > -1) {
                return $1;
            }

            $1.replace(utils.getRegexpScriptElementSrcAttrValue(), function ($2_1, $src) {
                //需要使用热加载的入口JS文件标识
                let hotTag = '?hot=true';
                if ($src && (global.debugDomain.test($src) || isExpressProject)) { //改为判断是否以$!{开头或者是express工程
                    let jsPath = $src.replace(regexpStaticFilesPrefix, '').replace(hotTag, '');

                    if (isExpressProject) {
                        jsPath = $src.replace(global.sfPrefix, '/').replace(hotTag, '');
                    }

                    if (!jsCacheList[jsPath]) {
                        if ($src.indexOf('bundle.js') != -1) {
                            let isPureReact = $src.toLowerCase().indexOf(hotTag) > -1;
                            let jsSrcPath = utils.normalizePath(path.join(global.staticDirectory, path.dirname(jsPath), 'main.js')).replace(global.deployPrefix, global.srcPrefix);

                            if (isPureReact) {
                                jsCompileListWithPureReact.push({
                                    "path": jsSrcPath
                                });
                            } else {
                                jsCompileList.push({
                                    "path": jsSrcPath
                                });
                            }

                            jsCacheList[jsPath] = true;
                        }
                    }
                }
            });
        });
    });

    jsCompileList = utils.jsonArrayUnique(jsCompileList);

    console.log('jsCompileList：');
    console.log(jsCompileList);

    console.log('jsCompileListWithPureReact：');
    console.log(jsCompileListWithPureReact);

    let commonConfig = {
        cache: true,
        resolve: {
            modules: [
                path.join(__dirname, "node_modules")
            ],
            extensions: ['.js', '.jsx'],
            alias: options.preact ? {
                'react': 'preact-compat',
                'react-dom': 'preact-compat'
            } : {}
        },
        resolveLoader: {
            modules: [
                path.join(__dirname, "node_modules")
            ]
        },
        devtool: utils.hasArgument(process.argv, '--eval') ? "eval" : "inline-source-map",
        mode: 'development',
    };

    let _presets = [
        [__dirname + "/node_modules/babel-preset-es2015", {"modules": false}],
        __dirname + "/node_modules/babel-preset-es2016",
        __dirname + "/node_modules/babel-preset-es2017",
        __dirname + "/node_modules/babel-preset-stage-3"
    ];

    if (options.preact) {
        _presets.push(__dirname + "/node_modules/babel-preset-preact");
    } else {
        _presets.push(__dirname + "/node_modules/babel-preset-react");
    }

    let babelSettings = {
        cacheDirectory: true,
        presets: _presets,
        compact: false,
        plugins: [
                __dirname + "/node_modules/babel-plugin-transform-decorators-legacy",
                __dirname + "/node_modules/babel-plugin-syntax-dynamic-import",
                __dirname + "/node_modules/babel-plugin-transform-react-loadable",
        ]
    };
    if (!options["vuehot"]) {
        async.map(jsCompileList, function (jsCompileItem, callback) {
            let rebuildCompile = false;
            let contextPath = path.join(global.staticDirectory, global.srcPrefix, 'js');
            let staticFilesSourceDir = path.join(global.staticDirectory, global.srcPrefix);
            let entryPath = './' + jsCompileItem.path.replace(utils.normalizePath(contextPath), '');
            let config = {
                context: contextPath,
                entry: entryPath,
                plugins: [
                    new webpack.DefinePlugin({
                        __DEVTOOLS__: options.preact ? true : false
                    })
                ],
                output: {
                    path: path.join(global.staticDirectory, global.deployPrefix, 'js', utils.normalizePath(path.dirname(jsCompileItem.path)).replace(utils.normalizePath(contextPath), '')),
                    filename: "bundle.js",
                    chunkFilename: "[name].bundle.js",
                    publicPath: utils.normalizePath(path.join(global.sfPrefix, utils.normalizePath(path.join(global.deployPrefix, 'js', utils.normalizePath(path.dirname(jsCompileItem.path)).replace(utils.normalizePath(contextPath), ''))), '/'))
                }
            };

            config.externals = {
                "react": "React",
                "react-dom": "ReactDOM",
                "redux": "Redux",
                "react-redux": "ReactRedux",
                "react-router": "ReactRouter",
                "react-router-dom": "ReactRouterDOM",
                "preact-redux": "preactRedux",
                "immutable": "Immutable",
                "vue": "Vue",
                "vue-router": "VueRouter",
                "vuex": "Vuex"
            };

            config.module = {rules: utils.getRules()};
            utils.extendConfig(config, commonConfig);

            config.module.rules.push({
                test: /\.(js|jsx)$/,
                type: "javascript/auto",
                use: [{loader: 'babel-loader', options: JSON.stringify(babelSettings)}],
                exclude: /(node_modules|bower_components)/,
                include: [staticFilesSourceDir]
            });

            let compiler = webpack(config);
            compiler.watch({
                aggregateTimeout: 300,
                poll: true
            }, function (err, stats) {
                if (err) {
                    throw err;
                }

                if (stats.hasErrors()) {
                    console.log('ERROR start ==============================================================');
                    console.log(stats.toString());
                    console.log('ERROR end   ==============================================================');
                } else {
                    console.log(stats.toString({colors: true}));
                }

                if (rebuildCompile) {
                    console.log('rebuild complete!');
                    if (global.socket) {
                        global.socket.emit("refresh", {"refresh": 1});
                        console.log("files changed： trigger refresh...");
                    }

                    if (isHttps && global.httpsSocket) {
                        global.httpsSocket.emit("refresh", {"refresh": 1});
                        console.log("[https] files changed: trigger refresh...");
                    }
                }

                if (typeof callback == 'function') {
                    callback();
                }

                if (!rebuildCompile) {
                    rebuildCompile = true;
                    callback = null;
                }
            });
        }, function (err) {
            if (err) {
                throw err;
            }

            //如果有需要使用react-hot-loader的入口JS
            if (jsCompileListWithPureReact.length) {
                let entryList = {};
                let debugDomain = typeof options.debugDomain == 'string' ? options.debugDomain : 'local.wenwen.sogou.com';
                jsCompileListWithPureReact.forEach(function (jsCompileItemWithPureReact) {
                    let entryKey = jsCompileItemWithPureReact.path.replace(utils.normalizePath(path.join(global.staticDirectory, 'src/')), 'sf/deploy/').replace('/main.js', '');
                    entryList[entryKey] = [
                        'webpack-hot-middleware/client?reload=true',
                        jsCompileItemWithPureReact.path
                    ];
                });

                let staticFilesSourceDir = path.join(global.staticDirectory, global.srcPrefix);

                let config = {
                    devtool: "eval",
                    entry: entryList,
                    plugins: [
                        new webpack.HotModuleReplacementPlugin(),
                        new webpack.DefinePlugin({
                            __DEVTOOLS__: options.preact ? true : false
                        })
                    ],
                    output: {
                        filename: "[name]/bundle.js",
                        chunkFilename: "[name].bundle.js",
                        publicPath: '//' + debugDomain + ':' + global.hotPort + '/'
                    },
                    optimization: {
                        noEmitOnErrors: true,
                    }
                };

                config.module = {rules: utils.getRules()};
                utils.extendConfig(config, commonConfig);
                config.externals = {};

                config.module.rules.push({
                    test: /\.(js|jsx)$/,
                    type: "javascript/auto",
                    use: [{
                        loader: 'babel-loader', options: JSON.stringify(babelSettings)
                    }],
                    include: [staticFilesSourceDir]
                });

                let express = require('express');
                let app = express();

                app.all('*', function (req, res, next) {
                    res.header("Access-Control-Allow-Origin", "*");
                    next();
                });

                let compiler = webpack(config);

                app.use(require('webpack-dev-middleware')(compiler, {
                    publicPath: config.output.publicPath
                }));

                app.use(require('webpack-hot-middleware')(compiler));

                app.get('*', function (req, res) {

                });

                let server;
                if (isHttps) {
                    let options = {
                        key: fs.readFileSync(path.join(__dirname, '/lib/ssl', 'client.key')),
                        cert: fs.readFileSync(path.join(__dirname, '/lib/ssl/', 'wenke.crt'))
                    };

                    server = require('https').createServer(options, app);
                } else {
                    server = require('http').createServer(app);
                }

                server.listen(global.hotPort, function (err) {
                    if (err) {
                        return console.error(err);
                    }

                    console.log('Hot loader server start listening at ' + (isHttps? "https": "http") + '://' + debugDomain + ':' + global.hotPort + '/');
                });
            }


            if (!utils.hasArgument(process.argv, '--norefresh')) {
                gulp.task('default', function () {
                    let watchFiles = [];

                    webappDirectoryList.forEach(function (item, index) {
                        let webappViewSrcDir = item + '/src/main/webapp/WEB-INF/view/src/';

                        if (isExpressProject) {
                            let fileList = fs.readdirSync(item);

                            fileList.forEach(function (filePath, index) {
                                let stat = fs.statSync(path.join(item, filePath));

                                //采用express推荐目录，只监控静态资源文件目录public以外的目录，同时忽略.svn等目录
                                if (stat.isDirectory()) {
                                    if (filePath.toLowerCase() !== 'public' && filePath.indexOf('.') !== 0 && filePath.indexOf('node_modules') !== 0) {
                                        if (filePath.toLowerCase() === 'views') {
                                            watchFiles.push(path.join(item, filePath, "/src/**/*.js"));
                                            watchFiles.push(path.join(item, filePath, "/src/**/*.jsx"));
                                            watchFiles.push(path.join(item, filePath, "/src/**/*.html"));
                                            watchFiles.push(path.join(item, filePath, "/src/**/*.tpl"));
                                        } else if (filePath.toLowerCase() === 'bin') {
                                            watchFiles.push(path.join(item, filePath, "/www"));
                                        } else {
                                            watchFiles.push(path.join(item, filePath, "/**/*.js"));
                                        }
                                    }
                                } else {
                                    if (path.extname(filePath) === '.js') {
                                        watchFiles.push(path.join(item, filePath));
                                    }
                                }
                            });
                        } else {
                            watchFiles.push(path.join(webappViewSrcDir + "/**/*.vm"));
                            watchFiles.push(path.join(webappViewSrcDir + "/**/*.html"));
                            watchFiles.push(path.join(webappViewSrcDir + "/**/*.tpl"));
                        }
                    });
                    watchFiles.push(cssCompileList);
                    console.log('watchFiles List: ');
                    console.log(watchFiles);
                    gulp.watch(watchFiles).on('change', function () {
                        if (global.socket) {
                            global.socket.emit("refresh", {"refresh": 1});
                            console.log("files changed： trigger refresh...");
                        }

                        if (isHttps && global.httpsSocket) {
                            global.httpsSocket.emit("refresh", {"refresh": 1});
                            console.log("[https] file changed: trigger refresh...");
                        }
                    });
                    utils.startWebSocketServer(isHttps);
                });

                gulp.start();
            } else {
                console.log('status: norefresh');
            }
        });
    } else {
        //检测到--vuehot参数，启动Vue.js热加载
        if (jsCompileList.length) {
            let entryList = {};
            let debugDomain = options.debugDomain || 'local.baike.sogou.com';
            //Vue入口文件的处理
            jsCompileList.forEach(function (item) {
                let entryKey = item.path.replace(utils.normalizePath(path.join(global.staticDirectory, 'src/')), 'sf/deploy/').replace('/main.js', '');
                entryList[entryKey] = [
                    'webpack-hot-middleware/client',
                    item.path
                ];
            });

            let staticFilesSourceDir = path.join(global.staticDirectory, global.srcPrefix);
            let config = {
                devtool: "eval",
                entry: entryList,
                plugins: [
                    new webpack.optimize.OccurrenceOrderPlugin(),
                    new webpack.HotModuleReplacementPlugin(),
                    new webpack.syntaxDynamicImport()
                ],
                output: {
                    filename: "[name]/bundle.js",
                    chunkFilename: "[name].bundle.js",
                    publicPath: '//' + debugDomain + ':' + global.hotPort + '/'
                },
                optimization: {
                    noEmitOnErrors: true,
                }
            };
            config.module = {rules: utils.getRules()};
            utils.extendConfig(config, commonConfig);
            config.externals = {
                "immutable": "Immutable",
                "vue": "Vue",
                "vue-router": "VueRouter",
                "vuex": "Vuex"
            };

            config.module.rules.push({
                test: /\.(js|jsx)$/,
                type: "javascript/auto",
                use: [{
                    loader: 'babel-loader', options: JSON.stringify(babelSettings)
                }],
                include: [staticFilesSourceDir]
            });

            let express = require('express');
            let app = express();
            app.all('*', function (req, res, next) {
                res.header("Access-Control-Allow-Origin", "*");
                res.header("Access-Control-Allow-Headers", "X-Requested-With");
                res.header("Access-Control-Allow-Methods", "PUT,POST,GET,DELETE,OPTIONS");
                res.header("X-Powered-By", ' 3.2.1')
                res.header("Content-Type", "application/json;charset=utf-8");
                next();
            });
            let compiler = webpack(config);

            app.use(require('webpack-dev-middleware')(compiler, {
                publicPath: config.output.publicPath
            }));

            app.use(require('webpack-hot-middleware')(compiler));

            app.get('*', function (req, res) {

            });

            app.listen(global.hotPort, function (err) {
                if (err) {
                    return console.error(err);
                }

                console.log('Hot loader server start listening at http://' + debugDomain + ':' + global.hotPort + '/');
            });
        }
    }
};