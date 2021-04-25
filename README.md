# Awala Gateway for Windows and Linux

macOS is not currently supported, although it _might_ work with some minimal changes.

## Development

### System dependencies

You need the following:

- Node.js 12+.
- [node-gyp's system dependencies](https://github.com/nodejs/node-gyp#installation) (e.g., Python 3).

### Setup

```shell
npm install
npx run bootstrap
```

### Code structure

This is a monorepo and all components can be found under [`packages`](./packages).
