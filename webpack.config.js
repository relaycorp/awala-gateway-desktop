const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = [
  {
    mode: 'development',
    entry: './src/electron/electron.ts',
    target: 'electron-main',
    module: {
      rules: [{
        test: /\.ts$/,
        include: /src/,
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
      include: /src/,
      use: [{ loader: 'ts-loader' }]
    }] },
    resolve: {
      extensions: ['.js', '.jsx', '.ts', '.tsx']
    },
    output: {
      path: __dirname + '/app',
      filename: 'react.js'
    },
    plugins: [
      new HtmlWebpackPlugin({
        template: './src/electron/index.html'
      })
    ]
  }
];

