import { fireEvent, render, screen } from "@testing-library/react";
import React from 'react';
import Gateway from './gateway';

describe('Gateway', () => {
  test('renders', async () => {
    const onEdit = jest.fn();
    render(<Gateway gateway="my.gateway" onEdit={onEdit}/>);
    expect(screen.getByDisplayValue("my.gateway")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Change Public Gateway", {exact: false}));
    expect(onEdit).toHaveBeenCalledTimes(1)
  });
});
