-- Drop old table if it exists (rerun this to reset during development)
-- DROP TABLE IF EXISTS bookings;

CREATE TABLE IF NOT EXISTS bookings (
    id              SERIAL PRIMARY KEY,
    booking_id      VARCHAR(20) UNIQUE NOT NULL,
    name            VARCHAR(255) NOT NULL,
    phone           VARCHAR(50) NOT NULL,
    email           VARCHAR(255),
    description     TEXT,
    service_provider VARCHAR(100) NOT NULL,
    relationship     VARCHAR(100),
    payment_status   VARCHAR(50) DEFAULT 'pending',
    date            DATE NOT NULL,
    time            TIME NOT NULL,
    location        VARCHAR(255),
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
