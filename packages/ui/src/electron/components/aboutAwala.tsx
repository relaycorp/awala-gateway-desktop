import { shell } from 'electron';
import React, { Component } from 'react';
import { version } from '../template.package.json';

class AboutAwala extends Component {
  public override render(): JSX.Element {
    return (
      <div className="about">
        <div className="logo"></div>
        <p>
          Version {version}
          <br />
          By Relaycorp
        </p>
        <div>
          <a href="https://awala.network/" onClick={this.onClickAwala}>
            Learn more about Awala
          </a>
          <br />
          <a href="https://awala.network/legal" onClick={this.onClickLegal}>
            Legal policies
          </a>
        </div>
      </div>
    );
  }

  private onClickAwala(event: React.MouseEvent<HTMLElement>): void {
    event.preventDefault();
    shell.openExternal('https://awala.network/');
  }
  private onClickLegal(event: React.MouseEvent<HTMLElement>): void {
    event.preventDefault();
    shell.openExternal('https://awala.network/legal');
  }
}

export default AboutAwala;
