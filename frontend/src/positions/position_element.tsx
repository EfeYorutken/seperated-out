import type { Position } from "../../../global_types/position";

const PositionElement = ( { pos } : {pos : Position} )=> {

  return (

    <div className="position borderable">
    <span className="basics" >

    <h3>{ pos.generic_information.job_title }</h3>

    { pos.generic_information.company } { pos.generic_information.location }

    </span>
    <span className="specific">

    { pos.found_by }<br/>
    { pos.generic_information.date_of_publish }

    </span>

    <button>Apply</button>

    </div>

  );

};

export default PositionElement;
