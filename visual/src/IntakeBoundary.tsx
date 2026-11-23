import {Component,type ReactNode} from 'react';
import {StatusPanel} from './BrandedState';
export class IntakeBoundary extends Component<{children:ReactNode},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){return this.state.failed?<StatusPanel kind="error" title="League Setup Could Not Be Displayed" action={<button className="button primary" onClick={()=>this.setState({failed:false})}>Try Again</button>}>Try loading the setup form again.</StatusPanel>:this.props.children;}
}
