'use strict';
var gulp = require('gulp');
var gutil = require('gulp-util');
var rename = require('gulp-rename');
var del = require('del');
var uglify = require('gulp-uglify');
var gulpif = require('gulp-if');
var exec = require('child_process').exec;
var fs = require('fs');

var notify = require('gulp-notify');

var buffer = require('vinyl-buffer');
var argv = require('yargs').argv;
// sass
var sass = require('gulp-sass');
var rubysass = require('gulp-ruby-sass');
var postcss = require('gulp-postcss');
var autoprefixer = require('autoprefixer-core');
var sourcemaps = require('gulp-sourcemaps');
var scsslint = require('gulp-scss-lint');

// BrowserSync
var browserSync = require('browser-sync');
// js
var watchify = require('watchify');
var browserify = require('browserify');
var source = require('vinyl-source-stream');
var babel = require('babelify');
var reactify = require('reactify');
// image optimization
var imagemin = require('gulp-imagemin');
// linting
var jshint = require('gulp-jshint');
var stylish = require('jshint-stylish');
// testing/mocha
var mocha = require('gulp-mocha');

var path = require('path');
var merge = require('merge-stream');
var wrap = require('gulp-wrap');
var declare = require('gulp-declare');
var concat = require('gulp-concat');

// gulp build --production
var production = !!argv.production;
// determine if we're doing a build
// and if so, bypass the livereload
var build = argv._.length ? argv._[0] === 'build' : false;
var watch = argv._.length ? argv._[0] === 'watch' : true;

// ----------------------------
// Error notification methods
// ----------------------------
var beep = function() {
  var os = require('os');
  var file = 'gulp/error.wav';
  if (os.platform() === 'linux') {
    // linux
    exec("aplay " + file);
  } else {
    // mac
    console.log("afplay " + file);
    exec("afplay " + file);
  }
};
var handleError = function(task) {
  return function(err) {
    beep();

    notify.onError({
      message: task + ' failed, check the logs..',
      sound: false
    })(err);

    gutil.log(gutil.colors.bgRed(task + ' error:'), gutil.colors.red(err));

    if (watch) this.emit('end');
  };
};

// --------------------------
// CUSTOM TASK METHODS
// --------------------------
var tasks = {
  // --------------------------
  // Delete build folder
  // --------------------------
  clean: function(cb) {
    del(['public/'], cb);
    return gulp.src('node_modules/.gitignore')
      .pipe(gulp.dest('public/')
    );
  },
  // --------------------------
  // SASS (libsass)
  // --------------------------
  sass: function() {
    return gulp.src('assets/scss/[^_]*.scss')
      //.pipe(scsslint())
      // sourcemaps + sass + error handling
      .pipe(gulpif(!production, sourcemaps.init()))
      .pipe(sass({
        errLogToConsole: true,
        sourceComments: !production,
        outputStyle: production ? 'compressed' : 'nested'
      }))
      .on('error', function(err) {
        sass.logError(err);
        if (watch) this.emit('end'); //continue the process in dev
      })
      // generate .maps
      .pipe(gulpif(!production, sourcemaps.write({
        'includeContent': false,
        'sourceRoot': '.'
      })))
      // autoprefixer
      .pipe(gulpif(!production, sourcemaps.init({
        'loadMaps': true
      })))
      .pipe(postcss([autoprefixer({browsers: ['last 2 versions']})]))
      // we don't serve the source files
      // so include scss content inside the sourcemaps
      .pipe(sourcemaps.write({
        'includeContent': true
      }))
      // write sourcemaps to a specific directory
      // give it a file and save
      .pipe(gulp.dest('public/css'));
  },
  // --------------------------
  // Reactify
  // --------------------------
  reactify: function() {
    // Create a separate vendor bundler that will only run when starting gulp
    var vendorBundler = browserify({
      debug: !production // Sourcemapping
    })
    .require('react');

    var bundler = browserify({
      debug: !production, // Sourcemapping
      cache: {},
      packageCache: {},
      fullPaths: false
    })
    .require(require.resolve('./source/app.jsx'), { entry: true })
    .transform(babel)
    .transform(reactify, {"es6": true})
    .external('react');

    var rebundle = function() {
      return bundler.bundle()
        .on('error', handleError('Browserify'))
        .pipe(source('app.js'))
        .pipe(buffer())
        .pipe(gulpif(production, uglify()))
        .pipe(gulpif(!production, sourcemaps.init({loadMaps: true})))
        .pipe(gulpif(!production, sourcemaps.write('./')))
        .pipe(gulp.dest('public/js/'));
    };

    if (watch) {
      bundler = watchify(bundler);
      bundler.on('update', rebundle);
    }

    vendorBundler.bundle()
    .pipe(source('vendors.js'))
    .pipe(gulpif(production, uglify()))
    .pipe(gulp.dest('public/js/'));

    return rebundle();
  },
  // --------------------------
  // React style guide
  // --------------------------
  reactstyleguide: function() {
    var bundler = browserify({
      debug: true,
      cache: {},
      packageCache: {},
      fullPaths: false
    })
    .require(require.resolve('./source/styleguide.jsx'), { entry: true })
    .transform(babel)
    .transform(reactify, {"es6": true})
    .external('react');

    var rebundle = function() {
      return bundler.bundle()
        .on('error', handleError('Browserify'))
        .pipe(source('styleguide.js'))
        .pipe(buffer())
        .pipe(sourcemaps.init({loadMaps: true}))
        .pipe(sourcemaps.write('./'))
        .pipe(gulp.dest('public/js/'));
    };

    if (watch) {
      bundler = watchify(bundler);
      bundler.on('update', rebundle);
    }

    return rebundle();
  },
  // --------------------------
  // linting
  // --------------------------
  lintjs: function() {
    return gulp.src([
        'source/index.js'
      ]).pipe(jshint({esnext: true}))
      .pipe(jshint.reporter(stylish))
      .on('error', function() {
        beep();
      });
  },
  // --------------------------
  // Optimize asset images
  // --------------------------
  assets: function() {
    return gulp.src('assets/images/**/*.{gif,jpg,png,svg}')
      // .pipe(imagemin({
      //   progressive: true,
      //   svgoPlugins: [{removeViewBox: false}],
      //   // png optimization
      //   optimizationLevel: production ? 3 : 1
      // }))
      .pipe(gulp.dest('public/images'));
  },
  // --------------------------
  // Testing with mocha
  // --------------------------
  test: function() {
    return gulp.src('source/**/*test.js', {read: false})
      .pipe(mocha({
        'ui': 'bdd',
        'reporter': 'spec'
      })
    );
  },
  data: function() {
    return gulp.src('data/**/*.json')
      .pipe(gulp.dest('public/data')
    );
  },
};

gulp.task('browser-sync', function() {
    browserSync({
        server: {
            baseDir: "public"
        },
        open: false,
        port: process.env.PORT || 3000
    });
});

gulp.task('reload-sass', ['sass'], function(){
  browserSync.reload();
});
gulp.task('reload-data', ['data'], function(){
  browserSync.reload();
});
gulp.task('reload-jsx', ['reactify', 'reactstyleguide'], function(){
  browserSync.reload();
});

// --------------------------
// CUSTOMS TASKS
// --------------------------
gulp.task('clean', tasks.clean);
// for production we require the clean method on every individual task
var req = build ? ['clean'] : [];
// individual tasks
gulp.task('assets', req, tasks.assets);
gulp.task('sass', req, tasks.sass);
gulp.task('reactify', req, tasks.reactify);
gulp.task('reactstyleguide', req, tasks.reactstyleguide);
gulp.task('lint:js', tasks.lintjs);
gulp.task('optimize', tasks.optimize);
gulp.task('test', tasks.test);
gulp.task('data', tasks.data);

// --------------------------
// DEV/WATCH TASK
// --------------------------
gulp.task('watch', ['assets', 'sass', 'reactify', 'reactstyleguide', 'data', 'browser-sync'], function() {
  // TODO: make watch restart on error, see: https://github.com/appium/DynamicApp/blob/master/injector/gulpfile.js

  // --------------------------
  // watch:assets
  // --------------------------
  gulp.watch('assets/images/**/*.{gif,jpg,png,svg}', ['assets']);

  // --------------------------
  // watch:sass
  // --------------------------
  gulp.watch(['assets/scss/**/*.scss', '!assets/scss/_old/**/*.scss'], ['reload-sass']);

  // --------------------------
  // watch:js
  // --------------------------
  gulp.watch('source/**/*.jsx', ['lint:js', 'reload-jsx']);

  // --------------------------
  // watch:data
  // --------------------------
  gulp.watch('data/**/*.json', ['reload-data']);

  gutil.log(gutil.colors.bgGreen('Watching for changes...'));
});

// build task
gulp.task('build', [
  'clean',
  'assets',
  'data',
  'sass',
  'reactify',
  'reactstyleguide'
]);

gulp.task('default', ['watch']);

// gulp (watch) : for development and livereload
// gulp build : for a one off development build
// gulp build --production : for a minified production build
