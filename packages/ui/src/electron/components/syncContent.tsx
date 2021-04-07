import React, { Component } from 'react';
import syncing from '../assets/syncing.svg';

interface Props {
  readonly image: string,
  readonly text: string,
  readonly title: string,
}
class SyncContent extends Component<Props> {
  public static readonly defaultProps = {
    image: syncing,
    title: "Syncing with a courier"
  };

  public render() : JSX.Element {
    return (
      <div className="sync">
        <h1>{this.props.title}</h1>
        <img src={this.props.image} />
        <p>{this.props.text}</p>
        <div className="progress">animation placeholder</div>
        <div> {this.props.children} </div>
      </div>
    );
  }
}

export default SyncContent;
