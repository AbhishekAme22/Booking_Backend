const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql');

const csv = require('csv-parser');
const readline = require("readline");
const fs = require("fs");
const app = express();
const port = 3000;


// MySQL database connection setup
const connection = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: '1234',
  database: 'booking_service22',
});

const stream = fs.createReadStream("./Seats.csv");
const rl = readline.createInterface({ input: stream });
let data = [];

rl.on("line", (row) => {
  data.push(row.split(","));
});

rl.on("close", () => {
  const headers = data.shift(); // Extracting column names from the first row

  const sql = "INSERT INTO SEATS (id, seat_identifier, seat_class) VALUES ?";
  connection.query(sql, [data], (error, results) => {
    if (error) {
      console.error("Error inserting data:", error);
    } else {
      console.log("Seats Data inserted successfully!");
    }
  });
});


const stream2 = fs.createReadStream("./SeatPricing.csv");
const rl2 = readline.createInterface({ input: stream2 });
let data2 = [];

rl2.on("line", (row) => {
  const cleanedRow = row.split(",").map(value => value.trim().replace(/\$/g, ''));
  data2.push(cleanedRow.map(value => value !== '' ? value : null));
});

rl2.on("close", () => {
  const headers = data2.shift(); // Extracting column names from the first row

  const sql2 = "INSERT INTO seat_pricing (id, seat_class, min_price, normal_price, max_price) VALUES ?";
  connection.query(sql2, [data2], (error, results) => {
    if (error) {
      console.error("Error inserting data:", error);
    } else {
      console.log("SeatPricing data inserted successfully!");
    }
   
  });
});


// Middleware
app.use(bodyParser.json());


// Retrieve all seats with booking status
app.get('/seats', (req, res) => {
  const query = 'SELECT seats.id, seats.seat_identifier, seats.seat_class, bookings.id AS booking_id FROM seats LEFT JOIN bookings ON seats.id = bookings.seat_id';
  connection.query(query, (error, results) => {
    if (error) {
      console.error('Error retrieving seats:', error);
      res.status(500).json({ error: 'Failed to retrieve seats.' });
    } else {
      res.json(results);
    }
  });
});

// Retrieve seat details and pricing based on the class
// Retrieve seat details and pricing based on seat class and bookings
app.get('/seats/:id', (req, res) => {
    const seatId = req.params.id;
  
    // Retrieve seat class for the specified seat
    const seatQuery = 'SELECT seat_class FROM seats WHERE id = ?';
    connection.query(seatQuery, [seatId], (error, seatResults) => {
      if (error) {
        console.error('Error retrieving seat details:', error);
        res.status(500).json({ error: 'Failed to retrieve seat details.' });
      } else if (seatResults.length === 0) {
        res.status(404).json({ error: 'Seat not found.' });
      } else {
        const seatClass = seatResults[0].seat_class;
  
        // Calculate the percentage of seats booked for the seat class
        const totalSeatsQuery = 'SELECT COUNT(*) AS total_seats FROM seats WHERE seat_class = ?';
        const bookedSeatsQuery = 'SELECT COUNT(*) AS booked_seats FROM bookings WHERE seat_id IN (SELECT id FROM seats WHERE seat_class = ?)';
        connection.query(totalSeatsQuery, [seatClass], (totalSeatsError, totalSeatsResults) => {
          if (totalSeatsError) {
            console.error('Error calculating total seats:', totalSeatsError);
            res.status(500).json({ error: 'Failed to retrieve seat pricing.' });
          } else {
            const totalSeats = totalSeatsResults[0].total_seats;
            console.log(totalSeats);
  
            connection.query(bookedSeatsQuery, [seatClass], (bookedSeatsError, bookedSeatsResults) => {
              if (bookedSeatsError) {
                console.error('Error calculating booked seats:', bookedSeatsError);
                res.status(500).json({ error: 'Failed to retrieve seat pricing.' });
              } else {
                const bookedSeats = bookedSeatsResults[0].booked_seats;
                const percentageBooked = (bookedSeats / totalSeats) * 100;
                console.log(percentageBooked)
                // Retrieve seat pricing based on the percentage of seats booked
                const pricingQuery = `
                SELECT
                seat_class,
                CASE
                  WHEN ? < 40 THEN COALESCE(min_price, normal_price, max_price)
                  WHEN ? >= 40 AND ? <= 60 THEN COALESCE(normal_price, min_price, max_price)
                  ELSE COALESCE(max_price, normal_price, min_price)
                END AS seat_price
              FROM
                seat_pricing
              WHERE
                seat_class = ?
              ORDER BY
                CASE
                  WHEN ? < 40 THEN 1
                  WHEN ? >= 40 AND ? <= 60 THEN 2
                  ELSE 3
                END
              LIMIT 1
              
                `;
                connection.query(pricingQuery, [percentageBooked, percentageBooked, percentageBooked,seatClass, percentageBooked, percentageBooked, percentageBooked], (pricingError, pricingResults) => {
                  if (pricingError) {
                    console.error('Error retrieving seat pricing:', pricingError);
                    res.status(500).json({ error: 'Failed to retrieve seat pricing.' });
                  } else if (pricingResults.length === 0) {
                    res.status(404).json({ error: 'Seat pricing not found.' });
                  } else {
                   
                    const seatPrice = pricingResults[0].seat_price;
                    res.json({ seatId, seatClass, seatPrice });
                  }
                });
              }
            });
          }
        });
      }
    });
  });
  

// Create a new booking for selected seats
app.post('/booking', (req, res) => {
    const { seatIds, userName, phoneNumber } = req.body;
  
    // Check if seats are already booked
    const checkQuery = 'SELECT id FROM bookings WHERE seat_id IN (?)';
    connection.query(checkQuery, [seatIds], (error, results) => {
      if (error) {
        console.error('Error checking seat bookings:', error);
        res.status(500).json({ error: 'Failed to create booking.' });
      } else if (results.length > 0) {
        const bookedSeats = results.map((row) => row.id);
        res.status(400).json({ error: 'Seats already booked.', bookedSeats });
      } else {
        // Calculate total amount based on seat pricing
        const pricingQuery = `
          SELECT
            seat_class,
            CASE
              WHEN (
                SELECT COUNT(*) FROM bookings
                WHERE seat_id IN (SELECT id FROM seats WHERE seat_class = seat_pricing.seat_class)
              ) < (
                SELECT COUNT(*) FROM seats WHERE seat_class = seat_pricing.seat_class
              ) * 0.4 THEN COALESCE(min_price, normal_price, max_price)
              WHEN (
                SELECT COUNT(*) FROM bookings
                WHERE seat_id IN (SELECT id FROM seats WHERE seat_class = seat_pricing.seat_class)
              ) >= (
                SELECT COUNT(*) FROM seats WHERE seat_class = seat_pricing.seat_class
              ) * 0.4 AND (
                SELECT COUNT(*) FROM bookings
                WHERE seat_id IN (SELECT id FROM seats WHERE seat_class = seat_pricing.seat_class)
              ) <= (
                SELECT COUNT(*) FROM seats WHERE seat_class = seat_pricing.seat_class
              ) * 0.6 THEN COALESCE(normal_price, min_price, max_price)
              ELSE COALESCE(max_price, normal_price, min_price)
            END AS seat_price
          FROM
            seat_pricing
          WHERE
            seat_class IN (SELECT seat_class FROM seats WHERE id IN (?))
          ORDER BY
            CASE
              WHEN (
                SELECT COUNT(*) FROM bookings
                WHERE seat_id IN (SELECT id FROM seats WHERE seat_class = seat_pricing.seat_class)
              ) < (
                SELECT COUNT(*) FROM seats WHERE seat_class = seat_pricing.seat_class
              ) * 0.4 THEN 1
              WHEN (
                SELECT COUNT(*) FROM bookings
                WHERE seat_id IN (SELECT id FROM seats WHERE seat_class = seat_pricing.seat_class)
              ) >= (
                SELECT COUNT(*) FROM seats WHERE seat_class = seat_pricing.seat_class
              ) * 0.4 AND (
                SELECT COUNT(*) FROM bookings
                WHERE seat_id IN (SELECT id FROM seats WHERE seat_class = seat_pricing.seat_class)
              ) <= (
                SELECT COUNT(*) FROM seats WHERE seat_class = seat_pricing.seat_class
              ) * 0.6 THEN 2
              ELSE 3
            END
          LIMIT 1
        `;
  
        connection.query(pricingQuery, [seatIds], (pricingError, pricingResults) => {
          if (pricingError) {
            console.error('Error retrieving seat pricing:', pricingError);
            res.status(500).json({ error: 'Failed to create booking.' });
          } else if (pricingResults.length === 0) {
            res.status(404).json({ error: 'Seat pricing not found.' });
          } else {
            let totalAmount = 0;
            pricingResults.forEach((row) => {
              const seatPrice = row.seat_price;
              totalAmount += seatPrice;
            });
  
            // Create the booking
            const insertQuery = 'INSERT INTO bookings (seat_id, user_name, phone_number) VALUES ?';
            const bookingData = seatIds.map((seatId) => [seatId, userName, phoneNumber]);
            connection.query(insertQuery, [bookingData], (insertError, insertResults) => {
              if (insertError) {
                console.error('Error creating booking:', insertError);
                res.status(500).json({ error: 'Failed to create booking.' });
              } else {
                const bookingId = insertResults.insertId;
                 
// Your AccountSID and Auth Token from console.twilio.com
const accountSid = 'AC0b4cb1ec3df9d1597745667a9a444e4f';
const authToken = '655f0a7006d4dc2c1a7ee84855451323';

const client = require('twilio')(accountSid, authToken);

client.messages
  .create({
    body: 'Thankyou For Booking '+userName+'your total amount is '+totalAmount,
    to: phoneNumber, // Text your number
    from: '+14027611794', // From a valid Twilio number
  })
  .then((message) => console.log(message.sid));
                res.json({ bookingId, totalAmount });
              }
            });
          }
        });
      }
    });
  });
  
  
  

// Retrieve bookings for a specific user identifier
app.get('/bookings', (req, res) => {
  const { userIdentifier } = req.query;
  const query = 'SELECT * FROM bookings WHERE user_name = ? OR phone_number = ?';
  connection.query(query, [userIdentifier, userIdentifier], (error, results) => {
    if (error) {
      console.error('Error retrieving bookings:', error);
      res.status(500).json({ error: 'Failed to retrieve bookings.' });
    } else {
      res.json(results);
    }
  });
});

// Start the server
app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
