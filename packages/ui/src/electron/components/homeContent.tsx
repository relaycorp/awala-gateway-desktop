import React, { Component } from 'react';

interface HomeContentProps {
  readonly title: string,
  readonly image: string,
  readonly className?: string
}
class HomeContent extends Component<HomeContentProps> {
  public override render(): JSX.Element {
    return (
      <div className="home">
        <img src={this.props.image} />
        <h1>{this.props.title}</h1>
        <div className={'content ' + this.props.className}>{this.props.children}</div>
      </div>
    );
  }
}

export default HomeContent;
