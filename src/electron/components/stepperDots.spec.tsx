import { render } from "@testing-library/react";
import React from 'react';
import StepperDots from './stepperDots';

describe('StepperDots', () => {
  test('renders', async () => {
    const el = render(<StepperDots count={4} selected={2} />);
    expect(el.container.children[0].children.length).toEqual(4);
    expect(el.container.children[0].children[2].outerHTML).toMatch("selected");
  });
});
