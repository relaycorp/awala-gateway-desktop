import React, { Component } from 'react';

interface HomeContentProps {
  readonly title: string,
  readonly image: string,
}
class HomeContent extends Component<HomeContentProps> {
  public render() : JSX.Element {
    return (
      <div className="home">
        <img src={this.props.image} />
        <h1>{this.props.title}</h1>
        <div> {this.props.children} </div>
      </div>
    );
  }
}

export default HomeContent;
