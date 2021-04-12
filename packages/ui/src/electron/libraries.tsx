import * as React from 'react';
import * as ReactDOM from 'react-dom';
import libraries from '../licenses.json';
import Libraries from './components/libraries';
import './styles.css';

ReactDOM.render(<Libraries libraries={libraries}/>, document.getElementById('app'));
