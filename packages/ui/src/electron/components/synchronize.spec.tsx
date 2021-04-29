import { render } from "@testing-library/react";
import React from 'react';
import Synchronize from './synchronize';

describe('Synchronize', () => {
  test('renders', async () => {
    const onComplete = jest.fn();
    const onReset = jest.fn();
    const el = render(<Synchronize token={"TOKEN"} onComplete={onComplete} onReset={onReset}/>);
    expect(el.container.firstChild).toBeTruthy();
  });
});
