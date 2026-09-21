import { CombinedGraphQLErrors, gql } from "@apollo/client";
import { useQuery } from "@apollo/client/react";

import PositionElement from "./position_element";
import type { JobInformation, Position } from '../../../global_types/position';

const Positions = ()=>{

  const positions_q = gql`

  query get_positions{
    get_positions {
      generic_information {
        job_title
        date_of_publish
        which_platform_was_it_found_on
        company
        location
      }
      found_by
    }
  }
  `;

  const {loading, error, data } = useQuery(positions_q);

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

      (data.get_positions as Position[]).map( (pos : Position) => {

        return (<PositionElement pos={pos} />);

      } )

    }

    </div>

  )

};

export default Positions;
