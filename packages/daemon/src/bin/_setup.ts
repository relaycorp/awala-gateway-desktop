/* istanbul ignore file */

import 'make-promises-safe';
import 'reflect-metadata'; // Needed for TypeORM and TypeDI

// Configure TypeORM with dependency injection
import { useContainer } from 'typeorm';
import { Container } from 'typeorm-typedi-extensions';
useContainer(Container);
