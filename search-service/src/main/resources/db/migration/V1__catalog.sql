CREATE TABLE station (
    code VARCHAR(8) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    city VARCHAR(100) NOT NULL
);

CREATE TABLE travel_class (
    code         VARCHAR(4) PRIMARY KEY,
    name         VARCHAR(50) NOT NULL,
    fare_per_km  NUMERIC(6,2) NOT NULL
);

CREATE TABLE train (
    number VARCHAR(10) PRIMARY KEY,
    name   VARCHAR(100) NOT NULL,
    type   VARCHAR(20)  NOT NULL
);

CREATE TABLE train_stop (
    train_number VARCHAR(10) NOT NULL REFERENCES train (number),
    seq          INT         NOT NULL,
    station_code VARCHAR(8)  NOT NULL REFERENCES station (code),
    arrival      VARCHAR(5),
    departure    VARCHAR(5),
    day_offset   INT         NOT NULL,
    km           INT         NOT NULL,
    PRIMARY KEY (train_number, seq)
);
CREATE INDEX train_stop_station_idx ON train_stop (station_code);

CREATE TABLE train_class (
    train_number VARCHAR(10) NOT NULL REFERENCES train (number),
    class_code   VARCHAR(4)  NOT NULL REFERENCES travel_class (code),
    coaches      INT         NOT NULL,
    seats        INT         NOT NULL,
    PRIMARY KEY (train_number, class_code)
);
