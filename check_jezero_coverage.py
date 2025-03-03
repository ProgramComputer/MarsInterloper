#!/usr/bin/env python3

# Script to check which MOLA data file covers the Jezero Crater coordinates
# Jezero Crater: 18.4446°N, 77.4509°E

import os
import glob

def check_coverage():
    print("Checking which MOLA data file covers Jezero Crater (18.4446°N, 77.4509°E)...")
    
    # Coordinates of Jezero Crater
    jezero_lat = 18.4446  # North latitude
    jezero_lon = 77.4509  # East longitude
    
    # Directory containing MOLA data
    base_dir = "assets/mars_data"
    
    # Check all .lbl files
    label_files = []
    for root, dirs, files in os.walk(base_dir):
        for file in files:
            if file.endswith(".lbl"):
                label_files.append(os.path.join(root, file))
    
    print(f"Found {len(label_files)} label files.")
    
    # Analyze each label file
    files_covering_jezero = []
    all_files_info = []
    
    for lbl_file in label_files:
        min_lat = None
        max_lat = None
        min_lon = None
        max_lon = None
        
        # Extract coordinates from the label file
        with open(lbl_file, 'r') as f:
            lines = f.readlines()
            for i, line in enumerate(lines):
                if "MINIMUM_LATITUDE" in line:
                    parts = line.split("=")
                    if len(parts) > 1:
                        val = parts[1].split("<")[0].strip()
                        if val != "'N/A'" and val != "N/A":
                            try:
                                min_lat = float(val)
                            except ValueError:
                                min_lat = None
                elif "MAXIMUM_LATITUDE" in line:
                    parts = line.split("=")
                    if len(parts) > 1:
                        val = parts[1].split("<")[0].strip()
                        if val != "'N/A'" and val != "N/A":
                            try:
                                max_lat = float(val)
                            except ValueError:
                                max_lat = None
                elif "WESTERNMOST_LONGITUDE" in line:
                    parts = line.split("=")
                    if len(parts) > 1:
                        val = parts[1].split("<")[0].strip()
                        if val != "'N/A'" and val != "N/A":
                            try:
                                min_lon = float(val)
                            except ValueError:
                                min_lon = None
                elif "EASTERNMOST_LONGITUDE" in line:
                    parts = line.split("=")
                    if len(parts) > 1:
                        val = parts[1].split("<")[0].strip()
                        if val != "'N/A'" and val != "N/A":
                            try:
                                max_lon = float(val)
                            except ValueError:
                                max_lon = None
        
        # Store file information
        file_info = {
            "label_file": lbl_file,
            "coverage": f"Lat: {min_lat}° to {max_lat}°, Lon: {min_lon}° to {max_lon}°"
        }
        all_files_info.append(file_info)
        
        # Check if the file covers Jezero Crater
        if min_lat is not None and max_lat is not None and min_lon is not None and max_lon is not None:
            # Check if Jezero coordinates are within the range
            if min_lat <= jezero_lat <= max_lat and min_lon <= jezero_lon <= max_lon:
                img_file = lbl_file.replace(".lbl", ".img")
                img_exists = os.path.exists(img_file)
                files_covering_jezero.append({
                    "label_file": lbl_file,
                    "img_file": img_file,
                    "img_exists": img_exists,
                    "coverage": f"Lat: {min_lat}° to {max_lat}°, Lon: {min_lon}° to {max_lon}°"
                })
    
    # Print all files and their coverage
    print("\nAll found files and their coverage:")
    for file_info in all_files_info:
        print(f"  {os.path.basename(file_info['label_file'])}:")
        print(f"    Coverage: {file_info['coverage']}")
    
    # Display results for Jezero coverage
    if files_covering_jezero:
        print("\nFiles that cover Jezero Crater:")
        for file_info in files_covering_jezero:
            print(f"\n  {os.path.basename(file_info['label_file'])}:")
            print(f"    Coverage: {file_info['coverage']}")
            print(f"    Image file exists: {file_info['img_exists']}")
            
            # Check file size if image exists
            if file_info['img_exists']:
                img_size = os.path.getsize(file_info['img_file']) / (1024 * 1024)  # Size in MB
                print(f"    Image file size: {img_size:.2f} MB")
    else:
        print("\nNo files found that cover Jezero Crater coordinates.")
        
        # Find the closest file
        closest_file = None
        min_distance = float('inf')
        
        for lbl_file in label_files:
            min_lat = None
            max_lat = None
            min_lon = None
            max_lon = None
            
            # Extract coordinates from the label file
            with open(lbl_file, 'r') as f:
                lines = f.readlines()
                for i, line in enumerate(lines):
                    if "MINIMUM_LATITUDE" in line:
                        parts = line.split("=")
                        if len(parts) > 1:
                            val = parts[1].split("<")[0].strip()
                            if val != "'N/A'" and val != "N/A":
                                try:
                                    min_lat = float(val)
                                except ValueError:
                                    min_lat = None
                    elif "MAXIMUM_LATITUDE" in line:
                        parts = line.split("=")
                        if len(parts) > 1:
                            val = parts[1].split("<")[0].strip()
                            if val != "'N/A'" and val != "N/A":
                                try:
                                    max_lat = float(val)
                                except ValueError:
                                    max_lat = None
                    elif "WESTERNMOST_LONGITUDE" in line:
                        parts = line.split("=")
                        if len(parts) > 1:
                            val = parts[1].split("<")[0].strip()
                            if val != "'N/A'" and val != "N/A":
                                try:
                                    min_lon = float(val)
                                except ValueError:
                                    min_lon = None
                    elif "EASTERNMOST_LONGITUDE" in line:
                        parts = line.split("=")
                        if len(parts) > 1:
                            val = parts[1].split("<")[0].strip()
                            if val != "'N/A'" and val != "N/A":
                                try:
                                    max_lon = float(val)
                                except ValueError:
                                    max_lon = None
            
            if min_lat is not None and max_lat is not None and min_lon is not None and max_lon is not None:
                # If Jezero is outside the latitude range
                if jezero_lat < min_lat or jezero_lat > max_lat:
                    lat_distance = min(abs(jezero_lat - min_lat), abs(jezero_lat - max_lat))
                else:
                    lat_distance = 0
                
                # If Jezero is outside the longitude range
                if jezero_lon < min_lon or jezero_lon > max_lon:
                    lon_distance = min(abs(jezero_lon - min_lon), abs(jezero_lon - max_lon))
                else:
                    lon_distance = 0
                
                distance = (lat_distance**2 + lon_distance**2)**0.5
                
                if distance < min_distance:
                    min_distance = distance
                    closest_file = {
                        "label_file": lbl_file,
                        "coverage": f"Lat: {min_lat}° to {max_lat}°, Lon: {min_lon}° to {max_lon}°",
                        "distance": distance
                    }
        
        if closest_file:
            print(f"\nClosest file to Jezero Crater:")
            print(f"  {os.path.basename(closest_file['label_file'])}:")
            print(f"    Coverage: {closest_file['coverage']}")
            print(f"    Distance: {closest_file['distance']:.2f}°")

if __name__ == "__main__":
    check_coverage() 