import React, { Component } from 'react';

interface Library {
  readonly author? : string;
  readonly department : string;
  readonly installedVersion : string;
  readonly licensePeriod : string;
  readonly licenseType : string;
  readonly link : string;
  readonly material : string;
  readonly name : string;
  readonly relatedTo : string;
}

interface Props {
  readonly libraries: ReadonlyArray<Library>;
}
class Libraries extends Component<Props> {
  public render() : JSX.Element {
    return (
      <div className='libraries'>
        { this.props.libraries.map(this.renderRow) }
      </div>
    );
  }
  private renderRow(lib : Library) : JSX.Element {
    const { name, licenseType, author, installedVersion } = lib;
    return (
      <div className='row'>
        <div className='item name'>{name} ({installedVersion})</div>
        <div className='item license'>{licenseType}</div>
        <div className='item author'>{author}</div>
      </div>
    );
  }
}

export default Libraries;
