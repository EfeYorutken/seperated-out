
const ProfileElement = ({ name } : {name : string})=> {

  return (

    <div className="profile borderable">
    <h3>{name}</h3>
    <div>this is where the find/time goes</div>
    <div>this is where the atribs goes</div>
    </div>

  );

};

export default ProfileElement;
