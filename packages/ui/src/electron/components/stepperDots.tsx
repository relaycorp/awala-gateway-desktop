import React from 'react';

interface Props {
  readonly count: number,
  readonly selected: number
}
function StepperDots(props: Props) : JSX.Element {
  const dots : readonly JSX.Element[] = Array.from(Array(props.count).keys()).map( (i: number) => {
    let className = "dot";
    if ( i === props.selected ) {
      className += " selected";
    }
    return <span key={i.toString()} className={className}></span>;
  });
  return <span className="dots">{dots}</span>;
}

export default StepperDots;
