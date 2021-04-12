import { render, screen } from "@testing-library/react";
import React from 'react';
import Libraries, { Library } from './libraries';

describe('Libraries', () => {
  test('renders', async () => {
    function generateLib(id : string) : Library {
      return {
        author : 'author_' + id,
        department : 'Physics',
        installedVersion : '1.2.3',
        licensePeriod : 'forever',
        licenseType : 'license_' + id,
        link : 'example.com',
        material : '',
        name : 'lib_' + id,
        relatedTo : '',
      };
    }
    const libs = ['a', 'b', 'c'].map(generateLib);
    render(<Libraries libraries={libs}/>);
    expect(screen.getByText('author_a')).toBeInTheDocument();
    expect(screen.getByText('author_b')).toBeInTheDocument();
    expect(screen.getByText('author_c')).toBeInTheDocument();
    expect(screen.getByText('license_a')).toBeInTheDocument();
    expect(screen.getByText('license_b')).toBeInTheDocument();
    expect(screen.getByText('license_c')).toBeInTheDocument();
    expect(screen.getByText('lib_a (1.2.3)')).toBeInTheDocument();
    expect(screen.getByText('lib_b (1.2.3)')).toBeInTheDocument();
    expect(screen.getByText('lib_c (1.2.3)')).toBeInTheDocument();
  });
});
