enum Mode { ON_SITE, REMOTE, HYBRID };

export type JobInformation = {
  job_title : string;
  date_of_publish : Date;
  description : string;//literally what the job needs you to do
  which_platform_was_it_found_on : string;
  company : string;//company name
  location : string | null;//ankara, istanbul, the continent of mu etc
  mode : Mode; //look at the defninition, you cant miss it
};

export type Position = {

  generic_information : JobInformation;
  //which profile found this
  found_by : string;//name of the finding profile
  application_link : string; //click here to apply

};
