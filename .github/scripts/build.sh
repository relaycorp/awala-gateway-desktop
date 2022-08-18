set -o nounset -o errexit -o pipefail

cd packages/daemon
npm run build
# Work around https://github.com/webpack-contrib/copy-webpack-plugin/issues/59
npm prune --omit=dev

cd ../ui
npm run build
