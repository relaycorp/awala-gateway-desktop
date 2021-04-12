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
      test: /\.(svg|png)$/i,
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
    filename: '[name].js'
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './src/electron/index.html',
      filename: '[name].html'
    }),
    new MiniCssExtractPlugin({filename: "styles.[hash].css"})
  ]
};

module.exports = [
  {
    mode: 'development',
    entry: './src/electron/main.ts',
    target: 'electron-main',
    module: {
      rules: [
        {
          test: /\.ts$/,
          include: /src/,
          use: [{ loader: 'ts-loader' }]
        },
        {
          test: /\.(png)$/i,
          type: 'asset/resource'
        },
      ]
    },
    resolve: {
      extensions: ['.js', '.ts']
    },
    output: {
      path: __dirname + '/app',
      filename: 'main.js',
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
    entry: { app: './src/electron/app.tsx', },
  },
  {
    ...rendererBaseConfig,
    entry: { about: './src/electron/about.tsx', },
  },
  {
    ...rendererBaseConfig,
    entry: { libraries: './src/electron/libraries.tsx', },
  }
];

