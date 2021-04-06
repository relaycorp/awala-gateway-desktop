import React, { Component } from 'react';

interface HomeContentProps {
  readonly title: string,
  readonly image: string,
}
class HomeContent extends Component<HomeContentProps> {
  public render() : JSX.Element {
    return (
      <div className="home">
        <h1>{this.props.title}</h1>
        <img src={this.props.image} />
        {this.props.children}
      </div>
    );
  }
}

export default HomeContent;
