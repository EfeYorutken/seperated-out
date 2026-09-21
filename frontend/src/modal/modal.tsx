import type { ReactNode} from 'react';

interface params{
  is_open : boolean;
  children : ReactNode;
  closer : ()=>void;
};

const Modal = ({ is_open, children, closer } : params)=>{

  if(is_open){
    return (
      <dialog className="model borderable" open>
      <button onClick={closer}>X</button>
      { children }
      </dialog>
    );
  }

  return null;

};

export default Modal;

