#!/usr/bin/env python3
"""
MOLA MEGDR Label File Analyzer
------------------------------
Reads and parses MOLA MEGDR label (.lbl) files to extract key information about
data coverage, resolution, and overlap between different datasets.
"""

import os
import glob
import re
from collections import defaultdict

class MolaLabelParser:
    def __init__(self, directory):
        self.directory = directory
        self.label_files = []
        self.datasets = defaultdict(list)
        
    def find_label_files(self):
        """Find all MOLA MEGDR label files in the directory and subdirectories."""
        print(f"Searching for .lbl files in {self.directory}...")
        
        # Find label files directly in the directory
        self.label_files.extend(glob.glob(os.path.join(self.directory, "*.lbl")))
        
        # Find label files in subdirectories
        for subdir in os.listdir(self.directory):
            subdir_path = os.path.join(self.directory, subdir)
            if os.path.isdir(subdir_path):
                self.label_files.extend(glob.glob(os.path.join(subdir_path, "*.lbl")))
        
        print(f"Found {len(self.label_files)} label files.")
        return self.label_files
    
    def extract_key_info(self, label_file):
        """Extract key information from a label file."""
        info = {
            'filename': os.path.basename(label_file),
            'resolution': None,
            'lat_min': None, 
            'lat_max': None,
            'lon_min': None,
            'lon_max': None,
            'pixels_per_degree': None,
            'lines': None,
            'samples': None
        }
        
        with open(label_file, 'r', errors='ignore') as f:
            content = f.read()
            
            # Extract resolution from filename or content
            resolution_match = re.search(r'megt.*?(\d+)_(\d+)\.lbl', info['filename'].lower())
            if resolution_match:
                info['pixels_per_degree'] = int(resolution_match.group(1))
            else:
                # For files like megt00n000hb.lbl
                if 'hb' in info['filename'].lower():
                    info['pixels_per_degree'] = 128
                elif 'gb' in info['filename'].lower():
                    info['pixels_per_degree'] = 64
                elif 'fb' in info['filename'].lower():
                    info['pixels_per_degree'] = 32
                elif 'eb' in info['filename'].lower():
                    info['pixels_per_degree'] = 16
            
            # Extract geographical coverage
            lat_match = re.search(r'MINIMUM_LATITUDE\s*=\s*([+-]?\d+\.\d+)', content)
            if lat_match:
                info['lat_min'] = float(lat_match.group(1))
                
            lat_match = re.search(r'MAXIMUM_LATITUDE\s*=\s*([+-]?\d+\.\d+)', content)
            if lat_match:
                info['lat_max'] = float(lat_match.group(1))
                
            lon_match = re.search(r'WESTERNMOST_LONGITUDE\s*=\s*([+-]?\d+\.\d+)', content)
            if lon_match:
                info['lon_min'] = float(lon_match.group(1))
                
            lon_match = re.search(r'EASTERNMOST_LONGITUDE\s*=\s*([+-]?\d+\.\d+)', content)
            if lon_match:
                info['lon_max'] = float(lon_match.group(1))
            
            # Extract grid dimensions
            lines_match = re.search(r'LINES\s*=\s*(\d+)', content)
            if lines_match:
                info['lines'] = int(lines_match.group(1))
                
            samples_match = re.search(r'LINE_SAMPLES\s*=\s*(\d+)', content)
            if samples_match:
                info['samples'] = int(samples_match.group(1))
        
        # Handle file naming conventions to extract latitude band
        filename = info['filename'].lower()
        if 'megt_n_' in filename:
            info['region'] = 'North Polar'
        elif 'megt_s_' in filename:
            info['region'] = 'South Polar'
        else:
            # Extract from standard MEGDR naming convention (e.g., megt00n000hb.lbl)
            name_match = re.search(r'megt(\d+)([ns])', filename)
            if name_match:
                latitude = int(name_match.group(1))
                hemisphere = 'North' if name_match.group(2) == 'n' else 'South'
                
                if latitude == 0:
                    info['region'] = 'Equatorial'
                elif latitude == 44:
                    info['region'] = f'Mid-{hemisphere}'
                elif latitude == 88:
                    info['region'] = f'Near-Polar {hemisphere}'
                else:
                    info['region'] = f'{latitude}° {hemisphere}'
            else:
                info['region'] = 'Unknown'
        
        return info
    
    def analyze_all_labels(self):
        """Analyze all found label files and organize by resolution."""
        if not self.label_files:
            self.find_label_files()
        
        print("Analyzing label files...")
        for label_file in self.label_files:
            info = self.extract_key_info(label_file)
            resolution_key = f"{info['pixels_per_degree']} pixels/degree"
            self.datasets[resolution_key].append(info)
        
        return self.datasets
    
    def print_summary(self):
        """Print a summary of all datasets with coverage information."""
        if not self.datasets:
            self.analyze_all_labels()
        
        print("\n=== MOLA MEGDR Datasets Summary ===")
        
        for resolution, files in sorted(self.datasets.items(), key=lambda x: int(x[0].split()[0]), reverse=True):
            print(f"\n## {resolution} Resolution ({len(files)} files)")
            
            for region_group in ['Equatorial', 'Mid-North', 'Mid-South', 'Near-Polar North', 'Near-Polar South', 'North Polar', 'South Polar']:
                region_files = [f for f in files if region_group in f.get('region', '')]
                
                if region_files:
                    print(f"\n  {region_group} Region:")
                    total_coverage = 0
                    
                    for file_info in sorted(region_files, key=lambda x: x['filename']):
                        # Calculate approximate coverage in square degrees
                        lat_range = abs(file_info['lat_max'] - file_info['lat_min']) if (file_info['lat_max'] and file_info['lat_min']) else 0
                        lon_range = abs(file_info['lon_max'] - file_info['lon_min']) if (file_info['lon_max'] and file_info['lon_min']) else 0
                        coverage = lat_range * lon_range
                        total_coverage += coverage
                        
                        print(f"    {file_info['filename']} - Lat: {file_info['lat_min']}° to {file_info['lat_max']}°, " 
                              f"Lon: {file_info['lon_min']}° to {file_info['lon_max']}°")
                    
                    mars_surface_area_percent = (total_coverage / 41252.96) * 100  # Mars is approximately 144,798,500 km² or 41,252.96 square degrees
                    print(f"    Coverage: ~{total_coverage:.1f} square degrees (~{mars_surface_area_percent:.1f}% of Mars surface)")
        
        # Print information about potential coverage gaps
        self._analyze_coverage_gaps()
        
        # Print information about overlaps between resolutions
        self._analyze_resolution_overlaps()
    
    def _analyze_coverage_gaps(self):
        """Analyze and report any gaps in Mars surface coverage."""
        print("\n=== Coverage Analysis ===")
        
        # Check for south polar coverage
        has_south_polar = False
        for dataset in self.datasets.values():
            for file_info in dataset:
                if 'South Polar' in file_info.get('region', '') or ('Near-Polar South' in file_info.get('region', '') and file_info.get('lat_min', 0) <= -75):
                    has_south_polar = True
                    break
            if has_south_polar:
                break
        
        if not has_south_polar:
            print("⚠️ WARNING: South Polar region (below ~75°S) appears to be missing from your data files.")
        
        # Check for complete longitude coverage in each latitude band
        for resolution, dataset in self.datasets.items():
            regions = defaultdict(list)
            for file_info in dataset:
                regions[file_info.get('region', 'Unknown')].append(file_info)
            
            for region, files in regions.items():
                # Skip if this is already a polar dataset with different coverage
                if 'Polar' in region:
                    continue
                    
                # Sort files by longitude minimum
                files_sorted = sorted(files, key=lambda x: x.get('lon_min', 0) or 0)
                
                # Check if we have gaps in longitude coverage
                if len(files_sorted) > 1:
                    longitude_coverage = []
                    for file_info in files_sorted:
                        lon_min = file_info.get('lon_min')
                        lon_max = file_info.get('lon_max')
                        if lon_min is not None and lon_max is not None:
                            longitude_coverage.append((lon_min, lon_max))
                    
                    # Check for gaps
                    if longitude_coverage:
                        gaps = []
                        prev_max = longitude_coverage[0][1]
                        
                        for i in range(1, len(longitude_coverage)):
                            current_min = longitude_coverage[i][0]
                            if current_min - prev_max > 1.0:  # Allow small rounding differences
                                gaps.append((prev_max, current_min))
                            prev_max = longitude_coverage[i][1]
                        
                        # Check if we wrap around 360°/0°
                        if longitude_coverage[-1][1] < 359.0 and longitude_coverage[0][0] > 1.0:
                            gaps.append((longitude_coverage[-1][1], longitude_coverage[0][0]))
                        
                        if gaps:
                            print(f"⚠️ {resolution}, {region}: Longitude gaps detected - {gaps}")
    
    def _analyze_resolution_overlaps(self):
        """Analyze areas where different resolutions overlap."""
        print("\n=== Resolution Overlap Analysis ===")
        
        if len(self.datasets) > 1:
            resolutions = sorted(self.datasets.keys(), key=lambda x: int(x.split()[0]), reverse=True)
            
            for i in range(len(resolutions)-1):
                high_res = resolutions[i]
                low_res = resolutions[i+1]
                
                print(f"\nComparing {high_res} with {low_res}:")
                
                # Check each high-res file for overlap with low-res files
                for high_file in self.datasets[high_res]:
                    high_lat_min = high_file.get('lat_min')
                    high_lat_max = high_file.get('lat_max')
                    high_lon_min = high_file.get('lon_min')
                    high_lon_max = high_file.get('lon_max')
                    
                    # Skip if we don't have enough information
                    if None in [high_lat_min, high_lat_max, high_lon_min, high_lon_max]:
                        continue
                    
                    overlaps = []
                    for low_file in self.datasets[low_res]:
                        low_lat_min = low_file.get('lat_min')
                        low_lat_max = low_file.get('lat_max')
                        low_lon_min = low_file.get('lon_min')
                        low_lon_max = low_file.get('lon_max')
                        
                        # Skip if we don't have enough information
                        if None in [low_lat_min, low_lat_max, low_lon_min, low_lon_max]:
                            continue
                        
                        # Check for overlap
                        lat_overlap = (high_lat_min <= low_lat_max and high_lat_max >= low_lat_min)
                        lon_overlap = (high_lon_min <= low_lon_max and high_lon_max >= low_lon_min)
                        
                        if lat_overlap and lon_overlap:
                            # Calculate overlap area (approximate)
                            lat_overlap_min = max(high_lat_min, low_lat_min)
                            lat_overlap_max = min(high_lat_max, low_lat_max)
                            lon_overlap_min = max(high_lon_min, low_lon_min)
                            lon_overlap_max = min(high_lon_max, low_lon_max)
                            
                            overlap_area = (lat_overlap_max - lat_overlap_min) * (lon_overlap_max - lon_overlap_min)
                            
                            overlaps.append({
                                'file': low_file['filename'],
                                'region': low_file['region'],
                                'area': overlap_area,
                                'lat_range': (lat_overlap_min, lat_overlap_max),
                                'lon_range': (lon_overlap_min, lon_overlap_max)
                            })
                    
                    if overlaps:
                        print(f"  {high_file['filename']} ({high_file['region']}) overlaps with:")
                        for overlap in sorted(overlaps, key=lambda x: x['area'], reverse=True):
                            print(f"    - {overlap['file']} ({overlap['region']}): {overlap['area']:.1f} sq° at " 
                                  f"Lat {overlap['lat_range'][0]}° to {overlap['lat_range'][1]}°, "
                                  f"Lon {overlap['lon_range'][0]}° to {overlap['lon_range'][1]}°")

def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='Analyze MOLA MEGDR label files.')
    parser.add_argument('directory', nargs='?', default='assets/mars_data', 
                        help='Directory containing MOLA MEGDR label files (default: assets/mars_data)')
    args = parser.parse_args()
    
    analyzer = MolaLabelParser(args.directory)
    analyzer.find_label_files()
    analyzer.analyze_all_labels()
    analyzer.print_summary()

if __name__ == '__main__':
    main() 