const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const JobSchema = new Schema({
  job_id: {
    type: String,
    required: true,
    unique: true,
    dropDups: true,
  },
  date: {
    type: String,
    required: true,
  },
  client_name: {
    type: String,
    default: "",
  },
  location: {
    type: String,
    default: "",
  },
  job_type: {
    type: String,
    default: "linen",
  },
  linen: {
    type: [],
    default: [],
  },
  napkins: {
    type: [],
    default: [],
  },
  items: {
    type: [],
    default: [],
  },
  order_flowers: {
    type: Boolean,
    default: false,
  },
  bouqette: {
    type: Boolean,
    default: false,
  },
  notes: {
    type: String,
    default: "",
  },
  paid: {
    type: Boolean,
    default: false,
  },
  sent_invoice: {
    type: Boolean,
    default: false,
  },
  client_email: {
    type: String,
    default: "",
  },
  client_phone_number: {
    type: String,
    default: "",
  },
  client_type: {
    type: String,
    default: "client",
  },
  invoice_url: {
    type: String,
    default: "",
  },
  invoice_ids: {
    type: [],
    defualt: [],
  },
  linen_picked_up: {
    type: Boolean,
    default: false,
  },
  timestamp: {
    type: String,
    default: Date.now(),
  },
  job_profit: {
    type: Number,
    default: 0,
  },
  deposit_amount_recieved: {
    type: Number,
    default: 0,
  },
});

const Job = mongoose.model("Job", JobSchema);

module.exports = Job;
