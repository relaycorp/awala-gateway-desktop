import { render } from "@testing-library/react";
import React from 'react';
import LoadingAnimation from './loading';

describe('LoadingAnimation', () => {
  test('renders', async () => {
    render(<LoadingAnimation />);
  });
});
