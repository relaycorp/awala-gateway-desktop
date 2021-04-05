import { render } from "@testing-library/react";
import React from 'react';
import Home from './home';

describe('Home', () => {
  test('renders', async () => {
    const el = render(<Home />);
    expect(el.container.firstChild).toBeTruthy();
  });
});
