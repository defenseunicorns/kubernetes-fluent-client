const http2 = require("node:http2");
const { URL } = require("url");

const url = "https://jsonplaceholder.typicode.com/todos";

// Parse the URL to get the hostname and path
const parsedURL = new URL(url);

// Create an HTTP/2 client session
const client = http2.connect(parsedURL.origin);

// Define the headers for the HTTP/2 request
const headers = {
  ":method": "GET",
  ":path": parsedURL.pathname + parsedURL.search,
};

// Create the request
const req = client.request(headers);

// Buffer to store the response data
let data = "";

// Listen for data chunks
req.on("data", chunk => {
  data += chunk;
});

// Listen for the end of the response
req.on("end", () => {
  console.log("Response received:");
  console.log(JSON.parse(data));

  // Close the HTTP/2 session
  client.close();
});

// Listen for errors
req.on("error", err => {
  console.error("Request error:", err.message);
  client.close();
});

// End the request
req.end();
