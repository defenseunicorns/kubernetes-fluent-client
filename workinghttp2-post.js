const http2 = require("node:http2");
const { URL } = require("url");

function postToJsonPlaceholder() {
  const url = "https://jsonplaceholder.typicode.com/todos";
  const myURL = new URL(url);

  // Create an HTTP/2 client session
  const client = http2.connect(myURL.origin);

  // Define the headers for the POST request
  const headers = {
    ":method": "POST",
    ":path": myURL.pathname + myURL.search,
    "content-type": "application/json",
  };

  // Data to send in the POST request
  const postData = JSON.stringify({
    title: "foo",
    body: "bar",
    userId: 1,
  });

  // Create a promise to handle the request and response
  const response = new Promise((resolve, reject) => {
    // Create the request
    const req = client.request(headers);

    // Write data to the request
    req.write(postData);

    // Buffer to store the response data
    let rawData = "";

    // Listen for data chunks
    req.on("data", chunk => {
      rawData += chunk;
    });

    // Listen for the end of the response
    req.on("end", () => {
      console.log("Response received:", rawData);
      resolve(rawData);

      // Close the HTTP/2 session
      client.close();
    });

    // Handle errors
    req.on("error", err => {
      console.error("Error during POST request:", err);
      reject(err);
      client.close();
    });

    // End the request
    req.end();
  });

  return response;
}

// Execute the function to make the POST request
postToJsonPlaceholder()
  .then(response => {
    console.log("POST request completed successfully.");
  })
  .catch(err => {
    console.error("POST request failed:", err);
  });
