const HtmlWebpackPlugin = require('html-webpack-plugin');
const glob = require('glob')

module.exports = [
  {
    mode: 'development',
    entry: './src/electron/electron.ts',
    target: 'electron-main',
    module: {
      rules: [{
        test: /\.ts$/,
        include: /src\/electron/,
        use: [{ loader: 'ts-loader' }]
      }]
    },
    output: {
      path: __dirname + '/app',
      filename: 'electron.js'
    }
  },
  {
    mode: 'development',
    entry: './src/electron/react.tsx',
    target: 'electron-renderer',
    devtool: 'source-map',
    module: { rules: [{
      test: /\.ts(x?)$/,
      include: /src\/electron/,
      use: [{ loader: 'ts-loader' }]
    }] },
    output: {
      path: __dirname + '/app',
      filename: 'react.js'
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: './src/electron/index.html'
      })
    ]
  },
  {
    mode: 'development',
    entry: toObject(glob.sync('./src/**/*.spec.ts')),
    target: 'node',
    module: {
      rules: [{
        test: /\.ts$/,
        include: /src/,
        use: [{ loader: 'ts-loader' }]
      }]
    },
    resolve: {
      extensions: ['.js', '.jsx', '.ts', '.tsx'],
    },
    output: {
      path: __dirname + '/build/main',
      filename: '[name].js'
    }
  }
];

function toObject(paths) {
  var ret = {};

  paths.forEach(function(path) {
    // you can define entry names mapped to [name] here
    let filename = path.match(/\.\/src\/(.*)\.ts/)[1];
    ret[filename] = path;
  });

  return ret;
}
