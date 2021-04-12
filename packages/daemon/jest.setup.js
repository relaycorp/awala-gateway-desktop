require('reflect-metadata'); // Needed for TypeORM and TypeDI

// Configure TypeORM with dependency injection
const { useContainer } = require('typeorm');
const { Container } = require('typeorm-typedi-extensions');
useContainer(Container);
