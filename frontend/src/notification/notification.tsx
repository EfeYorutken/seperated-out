interface params {
  kind : 'error' | 'info' | 'success';
  message : string;
};

const Notification = ( { kind, message } : params ) => {

  return (
    <div className={`notification notification-${kind}`} role="alert">
      { message }
    </div>
  );

};

export default Notification;
