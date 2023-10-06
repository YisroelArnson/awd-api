require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { google } = require("googleapis");
const { mongoose } = require("mongoose");
const app = express();
const uri = process.env.MONGO_URI;
app.use(express.json());
app.use(cors({ origin: "*" }));

console.log(process.env.MONGO_URI);
console.log(process.env.PORT);

// //Create auth instance
const auth = new google.auth.GoogleAuth({
  keyFile: "credentials.json",
  scopes: [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
  ],
});

mongoose
  .connect(uri, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("Connected to DB"))
  .catch(console.error);

const Job = require("./models/Job");
const { secretmanager } = require("googleapis/build/src/apis/secretmanager");

// ------------------------------ HELPER FUNCTIONS ------------------------------------------
const getLinenDataFromId = (linenData, id, client_type) => {
  for (let i = 0; i < linenData.length; i++) {
    if (linenData[i][1] === id) {
      if (client_type == "customer") {
        return {
          linen_name: linenData[i][0],
          price: linenData[i][6],
        };
      } else {
        return {
          linen_name: linenData[i][0],
          price: linenData[i][7],
        };
      }
    }
  }
};

const getNapkinDataFromId = (napkinData, id, client_type) => {
  for (let i = 0; i < napkinData.length; i++) {
    if (napkinData[i][1] === id) {
      if (client_type == "customer") {
        return {
          napkin_name: napkinData[i][0],
          price: napkinData[i][5],
        };
      } else {
        return {
          napkin_name: napkinData[i][0],
          price: napkinData[i][6],
        };
      }
    }
  }
};

//Fetch linen from linen spreadsheet
const fetchLinenAndNapkinData = async (napkin = false) => {
  let linenQuery = "linen";
  if (napkin) linenQuery = "napkins";
  //Create client instance for auth
  const client = await auth.getClient();

  //Instance of google sheets api
  const googleSheets = google.sheets({ version: "v4", auth: client });

  //Read rows from spreadsheet "Linen"
  const getRows = await googleSheets.spreadsheets.values.get({
    auth,
    spreadsheetId: process.env.JOBS_SPREADSHEET_ID,
    range: linenQuery,
  });

  return getRows.data.values;
};

const updateDataOfInvoice = async (job) => {
  const spreadsheets_service = google.sheets({ version: "v4", auth });
  const request = {
    spreadsheetId: job.invoice_ids[job.invoice_ids.length - 1],
    resource: {
      valueInputOption: "USER_ENTERED",
      data: [
        {
          range: "Sheet1!C13",
          values: [[job.client_name]],
        },
        {
          range: "Sheet1!C14",
          values: [[job.date]],
        },
        {
          range: "Sheet1!E13",
          values: [[job.location]],
        },
        {
          range: "Sheet1!E14",
          values: [["Invoice #" + job.job_id]],
        },
        {
          range: "Sheet1!E34",
          values: [[job.deposit_amount_recieved]],
        },
      ],
      includeValuesInResponse: true,
      responseValueRenderOption: "FORMATTED_VALUE",
      responseDateTimeRenderOption: "FORMATTED_STRING",
    },
  };
  //Add linens to spreadsheet
  const linenData = await fetchLinenAndNapkinData();
  const napkinData = await fetchLinenAndNapkinData(true);

  let i = 18;

  job.linen.forEach((linen) => {
    let linenInfo = getLinenDataFromId(
      linenData,
      linen.unique_id,
      job.client_type
    );
    request.resource.data.push(
      {
        range: "Sheet1!A" + i,
        values: [[linen.count]],
      },
      {
        range: "Sheet1!B" + i,
        values: [[linenInfo.linen_name]],
      },
      {
        range: "Sheet1!D" + i,
        values: [[linenInfo.price]],
      }
    );
    i++;
  });

  job.napkins.forEach((napkin) => {
    let napkinInfo = getNapkinDataFromId(
      napkinData,
      napkin.unique_id,
      job.client_type
    );

    request.resource.data.push(
      {
        range: "Sheet1!A" + i,
        values: [[napkin.count]],
      },
      {
        range: "Sheet1!B" + i,
        values: [[napkinInfo.napkin_name]],
      },
      {
        range: "Sheet1!D" + i,
        values: [[napkinInfo.price]],
      }
    );
    i++;
  });

  const response = await spreadsheets_service.spreadsheets.values.batchUpdate(
    request
  );

  return response;
};

const copyInvoice = async (fileName) => {
  const invoiceFolderId = "1-6gcCvzjJtzQJpYI49RkdQyNJm8vbony";
  const TEMPLATE_FILE_ID = "13RlzJwxpgH5d5_wXeCrgBHHUlenAgf2KU9H_OhyF-Q4";

  const drive_service = google.drive({ version: "v3", auth });
  //Copy the file
  const resource = {
    name: fileName,
  };

  const copy = await drive_service.files.copy({
    resource,
    fileId: TEMPLATE_FILE_ID,
  });

  const copiedFileId = copy.data.id;
  //Move the newly copied file to the invoices folder
  const file = await drive_service.files.get({
    fileId: copiedFileId,
    fields: "parents",
  });

  // Move the file to the new folder
  const previousParents = file.data.parents
    .map(function (parent) {
      return parent.id;
    })
    .join(",");

  const files = await drive_service.files.update({
    fileId: copiedFileId,
    addParents: invoiceFolderId,
    removeParents: previousParents,
    fields: "id, parents",
  });

  return copiedFileId;
};

const pruneEmptyLinenAndNapkins = (items) => {
  let temp = [];
  for (let i = 0; i < items.length; i++) {
    if (items[i].unique_id != "" && items[i].count != 0) {
      temp.push(items[i]);
    }
  }
  return temp;
};

// ------------------------------ REQUEST HANDLERS ------------------------------------------------
// /
app.get("/", (req, res) => {
  res.send("Hello World!");
});
//Fetch all jobs
app.get("/jobs", async (req, res) => {
  const jobs = await Job.find();
  console.log("jobs fetched");
  res.json(jobs);
});

//Add a new job
app.post("/jobs", async (req, res) => {
  const jobs = await Job.find();

  greatestId = "-1";
  console.log(jobs);
  for (i = 0; i < jobs.length; i++) {
    if (parseInt(jobs[i].job_id) >= parseInt(greatestId)) {
      greatestId = jobs[i].job_id;
      console.log(greatestId);
    }
  }
  const job = new Job({
    job_id: (parseInt(greatestId) + 1).toString(),
    client_name: req.body.client_name,
    date: req.body.date,
    location: req.body.location,
    job_type: req.body.job_type,
    linen: await pruneEmptyLinenAndNapkins(req.body.linen),
    napkins: await pruneEmptyLinenAndNapkins(req.body.napkins),
    flowers: req.body.flowers,
    bouqette: req.body.bouqette,
    notes: req.body.notes,
    paid: req.body.paid,
    sent_invoice: req.body.sent_invoice,
    order_flowers: req.body.order_flowers,
    client_email: req.body.client_email,
    client_type: req.body.client_type,
    invoice_url: req.body.invoice_url,
    linen_picked_up: req.body.linen_picked_up,
  });

  job.save();
  console.log("Saved document: ", job);

  res.json(job);
});

//Delete specific document by ID
app.delete("/jobs/:id", async (req, res) => {
  const result = await Job.findByIdAndDelete(req.params.id);

  res.json(result);
});

//Deletes all entries
app.delete("/jobs", async (req, res) => {
  const result = await Job.remove({});

  res.json(result);
});

//Update an existing job by replacing the document with the request body.
app.put("/jobs/:id", async (req, res) => {
  const job = await Job.findOneAndUpdate(
    { _id: req.params.id },
    {
      ...req.body,
      linen: pruneEmptyLinenAndNapkins(req.body.linen),
      napkins: pruneEmptyLinenAndNapkins(req.body.napkins),
    },
    {
      new: true,
    }
  );
  console.log("Updated document: ", job);
  res.json(job);
});

//To change a specific attribute of a job. Id is from param and attribute is from body
app.put("/jobs/attribute/:id", async (req, res) => {
  const job = await Job.findOneAndUpdate(
    { _id: req.params.id },
    {
      $set: { [req.body.attribute]: req.body.value },
    },
    {
      new: true,
    }
  );
  console.log("Updated document: ", job);
  res.json(job);
});

//Fetch all rows from Linen spreadsheet
app.get("/linen", async (req, res) => {
  const rows = await fetchLinenAndNapkinData();
  console.log("linen fetched");
  res.send(rows);
});

//Fetch all rows from Napkins spreadsheet
app.get("/napkins", async (req, res) => {
  const rows = await fetchLinenAndNapkinData(true);
  console.log("napkins fetched");
  res.send(rows);
});

app.post("/invoice", async (req, res) => {
  const jobObject = await Job.findOne({ _id: req.body.id });
  const invoiceTitle =
    jobObject.client_name + " - " + jobObject.date + " - " + jobObject.location;
  const copiedFileId = await copyInvoice(invoiceTitle).catch((error) =>
    console.log(error)
  );
  const job = await Job.findOneAndUpdate(
    { _id: req.body.id },
    {
      $push: { invoice_ids: copiedFileId },
    },
    {
      new: true,
    }
  ).catch((error) => console.log(error));

  const resp = await updateDataOfInvoice(job).catch((error) =>
    console.log(error)
  );

  console.log("Invoice Creation Status: " + resp.status);
  res.sendStatus(resp.status);
});

app.listen(process.env.PORT, () =>
  console.log("Server listening on port " + process.env.PORT)
);

//------------------------ Save old functions for reference ------------------------------
const moveInvoiceToFolder = async (fileId) => {
  const folderId = "1aP-nXY8qS0sSeM57ATgXAfFwkspTr0BN";
  //Instance of google drive api
  const drive_service = google.drive({ version: "v3", auth });
  console.log(fileId);
  //Move file to invoices folder in google drive
  // Retrieve the existing parents to remove
  const file = await drive_service.files.get({
    fileId: fileId,
    fields: "parents",
  });

  // Move the file to the new folder
  const previousParents = file.data.parents
    .map(function (parent) {
      return parent.id;
    })
    .join(",");

  const files = await drive_service.files.update({
    fileId: fileId,
    addParents: folderId,
    removeParents: previousParents,
    fields: "id, parents",
  });

  return files.status;
};
const createNewInvoice = async (title) => {
  //Create client instance for auth
  const client = await auth.getClient();
  //Instance of google sheets api
  const spreadsheets_service = google.sheets({ version: "v4", auth });
  const resource = {
    properties: {
      title: title,
    },
  };

  try {
    //Create spreadsheet
    const spreadsheet = await spreadsheets_service.spreadsheets.create({
      resource,
      fields: "spreadsheetId",
    });
    console.log(`Spreadsheet ID: ${spreadsheet.data.spreadsheetId}`);

    return spreadsheet.data.spreadsheetId;
  } catch (err) {
    // TODO (developer) - Handle exception
    console.log(err);
    throw err;
  }
};

const updateStylesOfInvoice = async (spreadsheetId) => {
  const spreadsheets_service = google.sheets({ version: "v4", auth });

  const request = {
    spreadsheetId: spreadsheetId,
    resource: {
      requests: [
        {
          updateBorders: {
            range: {
              sheetId: 0,
              startRowIndex: 0,
              endRowIndex: 10,
              startColumnIndex: 0,
              endColumnIndex: 6,
            },
            top: {
              style: "DASHED",
              width: 1,
              color: {
                blue: 1.0,
              },
            },
            bottom: {
              style: "DASHED",
              width: 1,
              color: {
                blue: 1.0,
              },
            },
            innerHorizontal: {
              style: "DASHED",
              width: 1,
              color: {
                blue: 1.0,
              },
            },
          },
        },
      ],
      includeSpreadsheetInResponse: false,
    },
  };
  const response = (
    await spreadsheets_service.spreadsheets.batchUpdate(request)
  ).data;
  console.log(response);
};
