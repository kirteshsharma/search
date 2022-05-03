const express = require("express");
const app = express();
const fs = require('fs')
const data = require('./data.json');
const port = process.env.PORT || 8080; // default port to listen
var responseTime = require('response-time')
const search = require('./search')

app.use(responseTime())
app.get("/search", (req, res) => {
    if (!req.query.word) {
        res.status = 500;
        res.send({ status: 500, message: "Invalid Params" })
    }
    const mystuff = data;
    const results = search.go(req.query.word, mystuff, { key: 'word', limit: 25 })

    res.send(results.map(function (item) { return item["obj"]; }))
});

// start the Express server
app.listen(port, () => {
    console.log(`server started at http://localhost:${port}`);
});
