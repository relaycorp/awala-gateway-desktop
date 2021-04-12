import React, { Component } from 'react';
import { version } from '../template.package.json';

class AboutAwala extends Component {
  public render() : JSX.Element {
    return (
      <div className='about'>
        <div className='logo'></div>
        <p>
          Version {version}
          <br />
          By Relaycorp
        </p>
        <div>
          <a href='https://awala.network/'>Learn more about Awala</a>
          <br />
          <a href='https://awala.network/legal'>Legal policies</a>
        </div>
      </div>
    );
  }
}

export default AboutAwala;
