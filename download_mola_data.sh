#!/bin/bash

# Create a directory for the 128 pixels/degree data
mkdir -p assets/mars_data/meg128

# Base URL
BASE_URL="https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg128"

# Files to download - all .img and .lbl files
FILES=(
    "megt00n000hb.img" "megt00n000hb.lbl"
    "megt00n090hb.img" "megt00n090hb.lbl"
    "megt00n180hb.img" "megt00n180hb.lbl"
    "megt00n270hb.img" "megt00n270hb.lbl"
    "megt44n000hb.img" "megt44n000hb.lbl"
    "megt44n090hb.img" "megt44n090hb.lbl"
    "megt44n180hb.img" "megt44n180hb.lbl"
    "megt44n270hb.img" "megt44n270hb.lbl"
    "megt44s000hb.img" "megt44s000hb.lbl"
    "megt44s090hb.img" "megt44s090hb.lbl"
    "megt44s180hb.img" "megt44s180hb.lbl"
    "megt44s270hb.img" "megt44s270hb.lbl"
    "megt88n000hb.img" "megt88n000hb.lbl"
    "megt88n090hb.img" "megt88n090hb.lbl"
    "megt88n180hb.img" "megt88n180hb.lbl"
    "megt88n270hb.img" "megt88n270hb.lbl"
)

# Starting with the .lbl files first as they're smaller
echo "Downloading label files first..."
for FILE in "${FILES[@]}"; do
    if [[ $FILE == *.lbl ]]; then
        echo "Downloading $FILE..."
        wget -c "$BASE_URL/$FILE" -O "assets/mars_data/meg128/$FILE"
        sleep 1
    fi
done

# Then download the larger .img files
echo "Downloading image files (this will take some time)..."
for FILE in "${FILES[@]}"; do
    if [[ $FILE == *.img ]]; then
        echo "Downloading $FILE..."
        wget -c "$BASE_URL/$FILE" -O "assets/mars_data/meg128/$FILE"
        # Give a small pause between files
        sleep 2
    fi
done

echo "Download complete! Files are in assets/mars_data/meg128/" 