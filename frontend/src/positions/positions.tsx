import { gql } from "@apollo/client";
import { useQuery } from "@apollo/client/react";

import PositionElement from "./position_element";
import type { Position } from '../../../global_types/position';

type PositionsQuery = { get_positions : Position[] };

const Positions = ()=>{

  const positions_q = gql`

  query get_positions{
    get_positions {
      #the handle the remove button addresses the row by
      id
      generic_information {
        job_title
        date_of_publish
        which_platform_was_it_found_on
        company
        location
      }
      found_by
      application_link
    }
  }
  `;

  const {loading, error, data } = useQuery<PositionsQuery>(positions_q);

  if(loading){ return (<div className="positions borderable">Loading..</div>) }
  else if(error){

    console.error(`[POSITIONS ERROR] ${error}`); 

    return (<div className="positions borderable">Woops<br/> something went wrong:(</div>) 
  }

  return (

    <div className="positions borderable">
    <h1>
    this is where the positions goes
    </h1>

    {

      //the result comes back masked, this is the one place the shape is pinned
      (data as PositionsQuery).get_positions.map( (pos : Position) => {

        return (<PositionElement key={pos.id ?? pos.application_link} pos={pos} />);

      } )

    }

    </div>

  )

};

export default Positions;
