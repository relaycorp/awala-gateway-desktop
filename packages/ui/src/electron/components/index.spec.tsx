import { render } from "@testing-library/react";
import React from 'react';
import Index from './index';

describe('Index', () => {
  test('renders', async () => {
    const el = render(<Index />);
    expect(el.container.firstChild).toBeTruthy();
  });
});
