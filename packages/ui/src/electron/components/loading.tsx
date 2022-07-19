import React, { Component } from 'react';

export default class LoadingAnimation extends Component {
  public override render(): JSX.Element {
    return (
      <div className="loadingio-spinner-message">
        <div className="ldio">
          <div></div>
          <div></div>
          <div></div>
          <div></div>
        </div>
      </div>
    );
  }
}
