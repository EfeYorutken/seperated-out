interface params{

  id : number;
  name : string;
  platform : string;
  section : string;
  words : string[];
  anti_words : string[];
  published_after : string | null;
  set_2b_edited : ()=>void;
  clone_it : (id : number)=>void;
  delete_it : (id : number, name : string)=>void;
  busy : boolean;

};

const ProfileElement = (
  {id, name, platform, section, words, anti_words, published_after,
   set_2b_edited, clone_it, delete_it, busy} : params
)=> {

  return (

    <div className="borderable profile_element">

    <h3>{ name }</h3>
    <span>{platform}{section ? section : ''}
      { published_after ? ` | after ${published_after}` : '' }</span>

    <button disabled={busy} onClick={ ()=>{ clone_it(id) } }>clone</button>
    <button onClick={()=>{ set_2b_edited() }}>edit</button>
    <button className="danger" disabled={busy} onClick={ ()=>{ delete_it(id, name) } }>delete</button>

    <div className="borderable profile_keywords">
    <ul>
    {

      words.map((word : string, at : number)=>{
        return <li key={`${word}-${at}`}>{word}</li>
      })

    }
    </ul>
    {
      //only worth the space when there is something to veto
      anti_words.length > 0 && <p className="anti_keywords">not {anti_words.join(', ')}</p>
    }
    </div>

    </div>

  );

};

export default ProfileElement;