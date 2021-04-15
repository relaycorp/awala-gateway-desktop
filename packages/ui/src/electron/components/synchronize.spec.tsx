import { render } from "@testing-library/react";
import React from 'react';
import Synchronize from './synchronize';

describe('Synchronize', () => {
  test('renders', async () => {
    function onComplete() : void {
      return;
    }
    const el = render(<Synchronize token={"TOKEN"} onComplete={onComplete}/>);
    expect(el.container.firstChild).toBeTruthy();
  });
});
