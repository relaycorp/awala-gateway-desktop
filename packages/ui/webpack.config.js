const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');


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
    resolve: {
      extensions: ['.js', '.ts']
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
    module: { rules: [
      {
        test: /\.ts(x?)$/,
        include: /src/,
        use: [{ loader: 'ts-loader' }]
      },
      {
        test: /\.css$/i,
        use: [ MiniCssExtractPlugin.loader, 'css-loader' ],
      },
      {
        test: /\.svg/,
        type: 'asset/resource'
      },
      {
        test: /\.(woff|woff2|eot|ttf|otf)$/i,
        type: 'asset/resource',
      },
    ] },
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
      }),
      new MiniCssExtractPlugin({filename: "styles.[hash].css"})
    ]
  }
];

