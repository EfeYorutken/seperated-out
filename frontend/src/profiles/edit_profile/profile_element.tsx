interface params{

  name : string;
  platform : string;
  words : string[];
  set_2b_edited : ()=>void;

};

const ProfileElement = ({name, platform, words, set_2b_edited} : params)=> {

  return (

    <div className="borderable profile_element">

    <h3>{ name }</h3>
    <span>{platform} <button>crawl process</button></span>
    <button>clone</button>
    <button onClick={()=>{ set_2b_edited() }}>edit</button>

    <div className="borderable profile_keywords">
    <ul>
    {

      words.map((word : string)=>{
        return <li>{word}</li>
      })

    }
    </ul>
    </div>

    </div>

  );

};

export default ProfileElement;
