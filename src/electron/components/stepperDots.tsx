import React from 'react';

interface Props {
  readonly count: number,
  readonly selected: number
}
function StepperDots(props: Props) : JSX.Element {
  const dots : readonly JSX.Element[] = Array.from(Array(props.count)).map( (i: number) => {
    let className = "";
    if ( i === props.selected ) {
      className = "selected";
    }
    return <span className={className}>&middot;</span>;
  });
  return <span className="dots">{dots}</span>;
}

export default StepperDots;
