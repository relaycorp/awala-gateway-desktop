import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import Settings from './settings';
import { mockControlServer } from '../../testUtils/controlServer';

mockControlServer();

describe('Settings', () => {
  test('shows editor by default', async () => {
    const onComplete = jest.fn();
    render(<Settings token={'TOKEN'} onComplete={onComplete} />);
    expect(screen.getByText('Public gateway')).toBeInTheDocument();
  });
  test('closes', async () => {
    const onComplete = jest.fn();
    render(<Settings token={'TOKEN'} onComplete={onComplete} />);
    fireEvent.click(screen.getByText('Return to home'));

    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
