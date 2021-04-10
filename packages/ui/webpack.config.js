const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const CopyPlugin = require("copy-webpack-plugin");

const rendererBaseConfig = {
  mode: 'development',
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
  plugins: [
    new HtmlWebpackPlugin({
      template: './src/electron/index.html'
    }),
    new MiniCssExtractPlugin({filename: "styles.[hash].css"})
  ]
};

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
      filename: 'electron.js',
      clean: true
    },
    plugins: [
      new CopyPlugin({
        patterns: [
          { from: './src/electron/template.package.json', to: 'package.json' }
        ],
      }),
    ]
  },
  {
    ...rendererBaseConfig,
    entry: './src/electron/app.tsx',
    output: {
      path: __dirname + '/app',
      filename: 'app.js'
    },
  }
];

